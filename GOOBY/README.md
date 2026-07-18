# GOOBY 🐰 — 3.0 „ECHT & GROSS"

Gooby is a fat, lovable rabbit who lives in a cozy 3D apartment with his own
backyard garden. Feed him, wash him, tickle him, put him to bed, grow veggies,
fill two sticker collections, decorate his rooms and dress him in 42 outfits.
When the fridge is empty, drive through the low-poly city or run Shopping Surf
to the shop. Twenty-seven arcade minigames earn the coins that fuel it all.

A Pou / Talking-Tom-style virtual-pet game: mobile-first three.js web app, wrapped
with Capacitor for iOS. Fully offline, single-player, no server, no monetization.
Bilingual EN + DE (auto-detected, switchable in settings).

Returning from 1.0 or 2.0? Your save migrates losslessly, your home stays
exactly as you left it, and a one-time “What’s new in 3.0” panel tours the
additions.

## How to play

- **First run:** a short scripted tutorial („Das ist Gooby!") walks you through
  petting, feeding a carrot, a quick bath, the HUD, a 30-second Carrot Catch
  round (≥10 coins guaranteed), the shop door and a quick teaser of the quest
  board + garden. It resumes where you left off and is skippable after step 3.
- **Care (4 stats):** hunger, energy, hygiene, fun. Drag food from the fridge
  tray to Gooby's mouth, scrub him in the bathtub, tap the toilet, toss the
  ball, stroke him to pet, rub his belly to tickle, poke him (5 quick pokes =
  dizzy!). Stats drain in real time — even while the app is closed — and local
  notifications (opt-in) remind you when he needs you.
- **Tummy & health (2.0):** junk food (donuts, cake, ice cream…) and neglect
  make Gooby queasy, then properly sick — green cheeks, sneezes, thermometer.
  Feed him healthy, give medicine (40c, shop Care row), or drive him to the
  vet: full cure 120c, checkup 30c. Sick Gooby refuses minigames until cured;
  nothing is ever fatal.
- **Weight (2.0, cosmetic only):** junk food rounds him out, active minigames
  and ball fetches slim him down — four silhouette tiers from Sleek to Maximum
  Floof. Zero gameplay penalty; both extremes earn achievements.
- **Garden (2.0, level 3):** the 5th room dot leads outside. Buy seeds, plant
  up to 6 plots (plots 5/6 purchasable), water with the can — crops grow in
  REAL time, even while the app is closed, and rain waters them for you.
  Harvest to the fridge, eat or sell at the compost bin, fertilize for a 25%
  boost. 8 crops from radish (10 min) to watermelon (8 h).
- **Sleep:** tap the bedroom lamp or bed when his energy is low. Gooby snores
  through a 3-hour nap (shortcut: early wake after 30 min) and wakes with a yawn.
- **Rooms:** swipe between kitchen, living room, bathroom, bedroom and garden.
  Buy furniture, wallpapers and floors in the shop's Decorate tab — 58
  furniture buyables, 10 wallpapers, 7 floors, plus 6 garden decor slots.
- **City trips & Shopping Surf (3.0):** the front door offers two ways to the
  shop: **Fahren** through the rebuilt low-poly city, or **Laufen** in a fixed
  Shopping Surf run. Both arrive at the same shop. The vet stays drive-only;
  six named landmarks still award stickers.
- **Arcade — 27 minigames** (unlock by level): Carrot Catch, Bunny Hop,
  Shopping Cruise, Carrot Guard, Gooby Says, Memory Match, Basket Bounce,
  Garden Rush, Pancake Tower, Burger Build, **Shopping Surf**, Gooby Runner,
  Veggie Chop, **Purble Place**, Bubble Pop, Delivery Rush, Fishing Pond,
  Dance Party, Mini Golf, Trampoline Tricks, Goalie Gooby, Star Hopper, Pipe
  Flow, **Toy Grand Prix**, **Ghost Hunt**, **Rocket Rescue** and **Harbor
  Hopper**. First play of each game every day pays ×2 coins.
- **Daily quests (2.0, level 2):** the HUD clipboard shows 3 quests each day
  (rolled from a 28-entry pool), each paying coins + XP; one free reroll per
  day, fresh quests at midnight.
- **Albums:** the 2.0 album keeps its 4 collection sets totaling 32 stickers (fish,
  vegetables, landmarks, treats). The new **Stickerbuch (3.0)** adds 28
  illustrated Gooby moments across five pages, with hints and NEU markers.
- **Progression:** everything grants XP; each level pays a coin bonus and
  unlocks games/items up to level 40. 37 achievements pay coin rewards. A daily
  bonus streak (20…100 coins + food from day 7) claims on the first open per day.
- **Wardrobe & skins (3.0):** 42 outfits across hat, glasses, neck and the new
  back slot — Gooby wears them everywhere, including minigame cameos — plus 7
  fur-color skins (from level 5), from Snow to Golden.
- **Day/night & weather (2.0):** the real device clock drives dawn/day/dusk/
  night lighting at home, in the garden and in the city; deterministic weather
  (clear/cloudy/rain) shows in the windows and the garden — rain waters your
  plots, and everyone gets the same weather on the same day.
- **Stats & photo mode:** the profile screen shows vitals, lifetime totals and
  per-game bests for all 27 games; the HUD camera opens photo mode —
  pose, emotion, frame, snap — and saves/shares a UI-less PNG.
- **Nutella & Nougatschleuse (3.0):** buy Nutella as a snack, then install the
  kitchen’s Nougatschleuse to crank out messy chocolate globs.
- **Audio (3.0):** sampled Kenney effects replace UI bleeps, while five
  file-based jingle medleys cover home, garden, arcade, city and shop. Gooby’s
  synthesized voice and Dance Party’s beat stay intact. Settings has separate
  Master, SFX, Music, Gooby and Ambience sliders plus the quick mute.
- **Display & developer tools (3.0):** UI scale switches live among 85, 100,
  115 and 130 %. A hidden, persistent developer panel unlocks after five taps
  on the language “Auto” segment; normal players see no entry or hint.

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

URL params (dev builds): `?scene=home|gooby|roadtest`, `?room=…` (incl. `garden`),
`?minigame=<id>`, `?open=shop|wardrobe|achievements|arcade|settings|questBoard|album|profile`,
`?coins=N`, `?level=N`, `?energy=N`, `?hunger=N`, `?hygiene=N`, `?fun=N`,
`?fast=N` (clock multiplier), `?now=<epochMs>`, `?reset=1`, `?lang=de|en`,
`?sleep=1` (start a nap), `?autoplay=1` (bot-plays the launched minigame),
`?onboarding=0` (suppress the tutorial), `?uiscale=85|100|115|130`,
`?notch=1`, `?petdebug=1`, `?travel=surf|drive`, `?open=devPanel`.
Harness routes (`scene`/`minigame`/`open`) also suppress onboarding so test
surfaces stay clean. Feature demos:
`?skin=<id>` (own + equip a fur skin), `?outfits=<id,id>` (own + equip
outfits), `?dailydemo=N` (daily-bonus popup as streak day N), `?achdemo=1`
(seeded achievements screen), `?whatsnew=1` (force the What's-new panel),
`?autopilot=1` (bot-drives the shop trip), `?care=tray|wash|feed:<foodId>`
(care-loop demos). See PLAN.md §E9 and PLAN3.md §E0.2; `window.__gooby` exposes
store/ui/sceneManager/framework for console poking.

Try the framework smoke game: `http://localhost:5174/?minigame=_smoke`

## Project layout

`src/` splits by system: `core/` (store, save v3, clock, scenes, input, assets,
notifications), `character/` (procedural Gooby rig + outfits + fur skins),
`home/` (rooms incl. the garden, care interactions, decor), `city/` +
`systems/shopTrip.js` (drive/surf + shop/vet flow), `minigames/` (framework + 27
games, each with a pure `.logic.js`), `systems/` (stats, economy, leveling,
achievements, daily bonus, plus the 2.0 engines: garden, quests, collections,
health, weight, dayNight, weather, profileStats, plus stickerBook and nougat),
`audio/` (five-bus WebAudio manager, music director, sfx map, Gooby voice),
`gfx/` (tweens, particles, sky, weather FX), `ui/`
(HUD, screens, onboarding, What's-new), `data/` (constants = ALL design
numbers, strings EN+DE + versioned per-feature string modules, catalogs). Tests
in `test/` run headlessly against the pure modules. `PLAN.md` is the binding
v1 architecture contract (§E), `PLAN2.md` the binding 2.0 spec and `PLAN3.md`
the binding 3.0 spec — read them before restructuring anything.

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

### 1.0

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

### 2.0 „Vollversion"

- **Wave 1 — foundations:** 2.0 Kenney assets (suburban/minigolf/space kits),
  save schema v2 + lossless v1 migration, all catalogs (32 foods, 8 crops, 28
  quests, 4 sticker sets, 7 skins, 33 achievements, level cap 40), economy v2
  APIs, pure engines: garden, quests, collections, profile stats, day/night,
  weather, health (sickness), weight.
- **Wave 2 — spaces & systems:** the garden as a 5th navigable outdoor room
  (plots, seed/sell panels, sky dome, forecast), pet-sim wiring (health/weight/
  garden ticks, offline catch-up, harvest + sick notifications), city 2.0 (vet
  clinic destination, 6 sticker landmarks, vet panel), content & shop 2.0
  (+30 furniture, +4 wallpapers, +3 floors, 9 outfits, fur-skin try-on),
  progression UI (quest board, sticker album, profile screen, photo mode).
- **Wave 3 — minigames I + ambience:** Gooby Says, Garden Rush, Burger Build,
  Star Hopper, Pipe Flow; day/night + weather visuals everywhere (garden rain,
  window skies, dusk lamps, city night headlights).
- **Wave 4 — minigames II + ship polish:** Veggie Chop, Goalie Gooby, Delivery
  Rush, Mini Golf; audio & reactions 2.0 (bespoke synth recipes, new idles);
  onboarding teaser step, one-time "What's new" panel for 1.0 veterans, docs
  + integration sweep.

### 3.0 „ECHT & GROSS"

- **Wave 1 — foundations:** KayKit glTF/skinned-model pipeline, five-bus audio
  with sampled UI sounds and context medleys, UI scale/safe areas, hidden dev
  panel, sticker-book engine/catalog, save schema v3 + lossless migrations,
  Nutella/Nougatschleuse and the driving-road rebuild.
- **Wave 2 — flagships & outfits:** Shopping Surf plus its Laufen shop route,
  Purble Place cake shop, and 22 new outfits with a fourth back slot.
- **Wave 3 — games with depth:** Toy Grand Prix, Ghost Hunt, Rocket Rescue and
  Harbor Hopper bring the arcade to 27; all 21 earlier games receive a
  feature/bug-depth pass.
- **Wave 4 — ship polish:** real-prop replacement, Kenney 9-slice UI reskin,
  one-time 3.0 veteran tour, NEU content ribbons, docs/version/integration
  sweep.

## Credits

- 3D models & audio: [Kenney](https://kenney.nl) CC0 asset packs and
  [KayKit](https://kaylousberg.itch.io/) asset packs (see committed licenses).
- Gooby’s body and voice remain procedural; no library model replaces him.
