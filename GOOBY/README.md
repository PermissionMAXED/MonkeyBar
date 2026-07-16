# GOOBY 🐰

Gooby is a fat, lovable rabbit who lives in a cozy 3D apartment. Feed him, wash him,
tickle him, put him to bed, decorate his rooms, dress him up — and when the fridge is
empty, hop in the car and drive through a sunny low-poly city to the shop. Twelve
arcade minigames earn the coins that fuel it all.

A Pou / Talking-Tom-style virtual-pet game: mobile-first three.js web app, wrapped
with Capacitor for iOS. Fully offline, single-player, no server, no monetization.

> **Status:** in development. This README is a stub — the final version (play guide,
> iOS build & sideload instructions) lands with Wave 5. See `PLAN.md` for the full
> build plan and architecture contracts.

## Quick start

```bash
npm install
npm run dev        # dev server on http://localhost:5174
```

## Scripts

| command | what it does |
|---|---|
| `npm run dev` | Vite dev server on port 5174 |
| `npm run build` | production build → `dist/` |
| `npm run preview` | serve the production build on 5174 |
| `npm test` | `node --test` suites in `test/` |
| `npm run lint` | ESLint (flat config) |
| `npm run shot -- "<url>" shots/<name>.png` | headless-Chrome screenshot of a URL |

## Dev harness

URL params (dev builds): `?scene=home|gooby`, `?room=…`, `?minigame=<id>`,
`?coins=N`, `?level=N`, `?energy=N`, `?hunger=N`, `?hygiene=N`, `?fun=N`,
`?fast=N` (clock multiplier), `?now=<epochMs>`, `?reset=1`, `?lang=de|en`.
See PLAN.md §E9.

Try the framework smoke game: `http://localhost:5174/?minigame=_smoke`

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
