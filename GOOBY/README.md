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
