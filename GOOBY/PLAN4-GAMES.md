# PLAN4-GAMES.md — GOOBY 4.0 „VOLLVERSION FINAL" game-side specs (PLAN agent B)

Binding spec for every GAME-side workstream of GOOBY 4.0. Companion documents:
`PLAN4.md` §A/§B/§C-SYS (plan agent A — systems: save v4, modifier engine,
credits screen, music, settings backend) and plan agent C's wave/eval plan
built from both. Everything here follows the PLAN.md §E contracts, PLAN2/3
conventions, and the PLAN3 §E0.1 rulings (strings in versioned modules —
4.0 uses `strings/v4-*.js`; constants.js frozen — per-game numbers live in the
owning `.logic.js`; §E8 purity: every gameplay number/rule in this file lands
in a pure `.logic.js` and is what `node:test` hits).

Cross-plan contract points are marked **[→A]** (plan A owns the system, this
file owns the game-side shape) and **[→C]** (sequencing/eval note for plan C).
There are no TBDs in this document; where two options existed, the decision is
made inline with rationale.

Contents:

- §G1 Purble Place authentic rework („Comfy Cakes" 1:1)
- §G2 Controls-consistency standard + full 27-game direction audit
- §G3 Base-mapping fixes (flipped games) + „Steuerung invertieren" setting
- §G4 Shopping-Surf speed-feel juice package (+ runner-class rollout)
- §G5 Difficulty system (Leicht/Mittel/Schwer) + ENDLOS mode
- §G6 Gooby Welt — Gaussian-splat special game
- §G7 Cover arts, arcade tile redesign, pre-game screen
- §G8 Modifier-system integration contract (engine is plan A's)
- §G9 Game-side content: room dressing, food value display, new foods
- §G10 Game bug-sweep checklist (build-wave acceptance per game)
- §G11 Dependencies & ordering for plan C

---

## §G1. Purble Place authentic rework — „Comfy Cakes" 1:1

### G1.1 Research summary (what the Vista original actually does)

Sources: Wikipedia „Purble Place/Comfy Cakes", gamia-archive fandom wiki,
purble-place.io how-to-play. Verified mechanics of the original:

1. Fixed 2D side view of a bakery assembly line rendered in a 3D look; the
   whole belt + all stations are visible at once on a desktop screen.
2. **The PLAYER drives the conveyor belt** (arrow keys / on-machine arrows,
   forward AND backward) — pans only move when the player moves the belt.
3. Ingredients drop when the player presses a **per-nozzle button** (space /
   click). The drop only lands in a pan if the pan is positioned under that
   nozzle; a mistimed/misaligned press spills batter onto the belt/floor.
4. Station order on the line: pan feed → **3 batter spouts** (one per
   flavor — the flavor is chosen by WHICH spout you stop under) → **oven** →
   filling/icing spouts → decoration sprinkler → **shipping box** at the far
   right.
5. Orders are shown as pictogram cakes on a TV; wrong cakes are penalized and
   thrown away; higher levels put **multiple pans on the same belt in
   parallel**; disallowed moves get a friendly „not allowed" buzz.
6. Feel: forgiving-but-skillful — nothing one press can't cause is punished;
   the tension comes from juggling belt position against multiple pans and
   the oven.

Owner note reconciled: the owner listed „oven at the end". In the original
the oven sits directly after the batter spouts (icing must go on a BAKED
sponge). **Decision: keep the original order** (Teig → Ofen → Guss → Deko →
Kerzen → Versandbox); the shipping box is the true end-of-belt station, so
„am Ende steht der Ofen(-bereich) und dann Versand" still reads true on
screen. This is the 1:1-faithful choice and it preserves the „cake #2 burns
while you decorate cake #1" tension that defines Comfy Cakes.

### G1.2 What's wrong today (delta to the current purblePlace)

The current game (§C9) auto-runs the belt at 0.55 m/s and the player taps a
station button while a cake passes a 0.9 s window — the player controls
neither WHEN the cake arrives nor when the ingredient physically drops. The
rework inverts this: the belt is player-driven, drops are physical projectiles
with fall time, and the timing skill is real. Everything that already works —
ticket generator, pictogram cards, match/scoring matrix, NPC customers, coin
economy — is kept verbatim.

### G1.3 Core loop (rework, binding)

Fixed side-view camera. A 6.0 m belt runs left→right through fixed stations.
The player: (a) spawns pans (choosing the shape), (b) holds ◀/▶ pedals to
drive the belt (all pans move together — one belt), (c) presses per-nozzle
drop buttons to release ingredients at the right moment, (d) bakes by driving
the pan through the oven tunnel and OUT while the meter is green, (e) ships
finished cakes at the box, auto-matched against the best open ticket.
Round = 210 s fixed (unchanged). Score model unchanged in totals (§G1.8) so
coin row `divisor 5, min 5, max 30`, energy 8, unlock **L6** all stay.

### G1.4 Layout & camera (numbers)

- Belt: length **6.0 m**, belt-space coordinate `s = 0 … 6.0`, world mapping
  `x = s − 3.0`, belt top at y = 0.72, world z = 0 (line parallel to screen).
- Camera: perspective FOV 40, position `(camX, 1.9, 7.4)`, lookAt
  `(camX, 1.05, 0)` — looks down −z, so **world +x = screen right** and the
  belt visibly runs left→right (§G2 standard satisfied by construction).
- The camera shows a **3.2 m window** of the belt and follows the „focus pan"
  (the pan nearest to an actionable station, else the last-touched pan):
  `camX = clamp(focusPanX, −1.4, +1.4)`, exponential follow k = 5/s. At
  ≥ 412 px viewport width the window widens to 3.6 m (FOV 44).
- **Belt overview strip** (because pans can be off-window): 100 %-wide,
  0.875 rem-tall DOM bar directly under the ticket row: station glyphs at
  their s positions, one dot per pan (dot tint = sponge color, pulsing red
  while a pan is inside the oven past green start), thin highlight showing
  the current camera window. Tapping the strip is NOT a control (display
  only).
- Station world dressing (§C9.6 set kept + itch.io „Tiny Treats Bakery"
  CC0 additions per `/workspace/asset-staging/itchio/REPORT.md`): KayKit
  Restaurant kitchencounter row + `wall_orderwindow` back-left (customers sit
  there, tickets appear beside them), Tiny Treats `display case`, `mixer`,
  `scale`, `register`, macaron/dough props on the back counter, hanging
  utensils strip. Gooby baker cameo (existing rig + outfits) stands behind
  the belt center and cheers/facepalms on serve outcomes. NPC customers stay
  exactly as today (1 animated skinned + 2 frozen poses; ≤ 250 draw calls).

### G1.5 Stations (positions, buttons, rules)

Nozzle/station table (belt-space `s`, all drops fall straight down at the
nozzle x):

| station id | s (m) | button label | drop | legal target |
|---|---|---|---|---|
| `spawn` | 0.15 | „🥘 Neue Form" (cycles ∘/□/♥ on the pan stack) | places a pan on the belt at s = 0.15 | belt spot free (no pan within 0.7 m) and pan cap not reached |
| `trash` | 0.15 | (no button) | reversing a pan fully off the belt's left end (s < 0.0) dumps it — pan lost, 0 points | any pan |
| `teig.vanilla` | 0.90 | vanilla batter | batter blob | EMPTY pan |
| `teig.chocolate` | 1.35 | chocolate batter | batter blob | EMPTY pan |
| `teig.strawberry` | 1.80 | strawberry batter | batter blob | EMPTY pan |
| `ofen` | tunnel 2.25–3.15 | (no button — belt-driven) | — | pan with raw batter |
| `guss.white` | 3.50 | white icing | icing pour | BAKED sponge, no icing yet |
| `guss.pink` | 3.95 | pink icing | icing pour | BAKED sponge, no icing yet |
| `guss.chocolate` | 4.40 | chocolate icing | icing pour | BAKED sponge, no icing yet |
| `deko.cherry` | 4.70 | cherry | topping drop | BAKED sponge, no topping yet |
| `deko.sprinkles` | 5.00 | sprinkles | topping shake | BAKED sponge, no topping yet |
| `deko.berries` | 5.30 | berries | topping drop | BAKED sponge, no topping yet |
| `kerzen` | 5.60 | candle (n presses = n candles, ≥ 0.18 s apart, max 4) | candle drop | BAKED sponge, < 4 candles |
| `versand` | 5.95 | „📦 Versand!" | — | BAKED pan with \|s − 5.95\| ≤ 0.30 |

Rules:

- **Belt pedals:** hold ▶ = forward at **0.9 m/s**, hold ◀ = reverse at
  **0.7 m/s**; velocity slews at 6 m/s² (tiny ease for feel; the logic ramp
  is linear). Both released = belt stopped. Both held = stopped (safety).
- **Drop physics:** press → nozzle squirt anim 0.35 s; the blob leaves the
  nozzle immediately and falls **0.55 m in 0.45 s** (fall time constant). Hit
  test at IMPACT time: a pan catches the drop iff `|panCenterS − nozzleS| ≤
  0.24 m` at impact. At full forward speed that is a 0.53 s spatial window,
  and the 0.45 s fall time forces a small press-ahead lead — this IS the
  timing skill. Per-nozzle re-press lockout 0.5 s.
- **Mistimed press** (no pan catches): splat decal on the belt at that x for
  4 s (rides the belt), splat sfx, **−2 points**, no other penalty.
- **Wrong-flavor catch** (pan catches a legal-type but ticket-wrong
  ingredient): the layer is applied — it becomes a wrong component at serve
  time (the §C9.4 matrix prices it). Fix = trash the pan (time loss only).
- **Illegal-type press while a pan is under the nozzle** (e.g. icing onto raw
  batter, second batter into a filled pan): the drop bounces off with the
  friendly original-style „buzz" (`ui.error` + pan wiggle), **0 points** —
  faithful to the original's „move disallowed". It does NOT splat (the pan
  physically blocks the belt spot).
- **Oven:** while a pan with raw batter is inside the tunnel (2.25 ≤ s ≤
  3.15), its bake meter accumulates: `bakeT += dt`. The meter UI is a vertical
  bar on the oven with the green zone marked. Leaving the tunnel commits the
  §C9.3 result: `bakeT < 2.25 s` = pale (±0, sponge still counts as baked),
  `2.25–3.0 s` = **perfect +5**, `> 3.6 s` = **singed −3** (singe commits
  automatically at 3.6 s even inside the tunnel; a singed sponge additionally
  counts as ONE wrong component at serve). Re-entering the tunnel resumes the
  same meter (you can fix a pale bake — and overdo it). Tunnel transit at
  full forward speed = 1.0 s, so a green bake REQUIRES stopping inside or two
  passes: belt skill, not a tap minigame.
- **Ship:** „Versand!" with a baked pan in the zone → auto-match against the
  open ticket with the fewest wrong components (tie → oldest ticket), §C9.4
  matrix verbatim: perfect **+20** (+ bake bonus already banked), one wrong
  **+8**, ≥ 2 wrong **−5** + cake splat + Gooby facepalm. Combo **+2** per
  consecutive non-rejected serve (cap +10), speed bonus **+4** at ≥ 50 %
  ticket patience left. Pressing Versand with no pan in the zone or an
  unbaked pan = the disallowed buzz (0 points).

### G1.6 Tickets, pacing, multiple pans

- Ticket model unchanged (§C9.2 verbatim): shape (∘/□/♥) × sponge
  (vanilla `#F5E6C8` / chocolate `#6B4A2F` / strawberry `#F2B8C6`) × icing
  (white/pink/chocolate/**none**) × topping (cherry/sprinkles/berries/
  **none**) × candles 0–4; pictogram cards top-left, max 3 parallel;
  patience 45 s → −1.5 s per serve, floor 30 s; expiry −5 + combo reset +
  sad customer walk-out. Complex tickets (candles ≥ 3, „none"-icing) only
  after serve #4. Order interval 30 s → −2 s per serve, floor 14 s.
- **Pan cap** (the „multiple simultaneous pans" difficulty): concurrent pans
  allowed = `min(3, 1 + floor(serves / 3))` — serve 0–2: 1 pan, 3–5: 2 pans,
  ≥ 6: 3 pans. The spawn button greys out at the cap. Belt speed does NOT
  ramp (the player drives it); pacing pressure comes from interval/patience/
  pan-count — this keeps the original's forgiving-but-skillful feel.
- Difficulty select (§G5) maps onto: Leicht = patience ×1.3, interval floor
  18 s, catch window ±0.30 m, singe at 4.2 s; Mittel = numbers above;
  Schwer = patience ×0.8, interval floor 12 s, catch window ±0.19 m, singe
  at 3.2 s, pan cap reaches 3 at serve 4.

### G1.7 Controls & layout at 320–430 px (BIG buttons, owner request)

- **Pedals:** two round DOM buttons, **4.5 rem (72 px @100 %)**, fixed
  bottom-left (◀) and bottom-right (▶), `bottom: calc(12px + var(--safe-
  bottom))`, `touch-action: none`, pointer capture, `aria-label`
  „Band zurück/vorwärts". Chevron glyph 2 rem. Held state scales 0.92 +
  color deepen (same pattern as g7-brake).
- **Station dock:** a horizontal DOM row between the pedals (height
  **4.0 rem**), showing the drop buttons of the nozzles currently inside the
  camera window, each **≥ 3.5 rem × 3.5 rem (56 px)**, horizontally aligned
  under their projected nozzle x (clamped to ≥ 0.5 rem gaps; max 4 buttons
  visible at 320 px, 5 at ≥ 412 px). Button face = the ingredient pictogram
  (reuses ticketSvg part renderers) on the station's color. Spawn button
  docks at the far left whenever the spawn station is in view; Versand at the
  far right when the box is in view (min 4.5 rem wide, pink `--pink`).
- Ticket cards: top-left, 4 rem × 3.5 rem each (unchanged pictograms), max 3.
  Belt overview strip directly under them (§G1.4). Framework HUD pills stay
  top-right; pause stays the framework's bottom-right — pedals shift inward
  0.5 rem at < 360 px so nothing overlaps at 130 % UI scale (verify in the
  §C1.3 matrix).
- No swipes, no drags: purble is 100 % button-driven (works for young
  players; inherently §G2-safe).

### G1.8 Scoring & economy (totals preserved)

Per-event points: perfect serve +20, one-wrong +8, reject −5, expiry −5,
bake perfect +5, singed −3, splat −2, combo +2…+10, speed bonus +4.
A competent 210 s round serves 6–8 cakes ⇒ typical score stays **≈ 120–150**
⇒ coin row `5/5/30` yields the same ~26 c. Meta unchanged:
`{ cakesServed, perfectCakes, rejected }` feeding `cakesServed`/
`perfectCakes` counters, sticker `cakeBoss`, quest hooks. Nougatschleuse
kitchen tie-in (§C6-v3) untouched.

### G1.9 Purity, bot, tests (§E8 contract)

`purblePlace.logic.js` is rewritten around a belt simulation, still pure:

- `createLine({ rng, difficulty })` → line state (pans[], belt v, tickets[],
  splats[], serves, score, clock).
- `stepLine(line, dt, input)` → events[]; `input = { belt: −1|0|1,
  press: stationId|null, spawnShape: 'round'|'square'|'heart'|null,
  ship: boolean }`. Events: `panSpawn, drop, catch, splat, buzz, bakeStart,
  bakeCommit, serve, reject, expire, ticketNew, trash`.
- Pure helpers kept/adapted: `patienceFor`, `orderIntervalAt`,
  `bakeResultAt`, `bakePoints`, ticket generator + match matrix (all reused
  verbatim), NEW `catchWindow(panS, nozzleS, difficulty)`,
  `dropImpactS(pressedAtS, beltPlan)`.
- **Bot** (autoplay + CI): plans one pan at a time against the oldest ticket:
  drive to spawn → spawn correct shape → drive under correct teig nozzle →
  stop → press (accounting for the 0.45 s fall by pressing when stationary) →
  drive into oven, wait until meter ≥ 2.4 s, drive out → icing → deko →
  candles ×n → ship. Opens a second pan only while the first bakes. Must
  average **≥ 90** over 20 seeded Mittel runs (same bar as today) and
  **≥ 120** on at least 1 of 5 Schwer runs (§G5 beatability gate).
- Tests: catch-window edges (±0.24 inclusive), fall-time lead math, oven
  commit/resume/auto-singe, disallowed matrix (icing-on-raw etc.), trash,
  pan-cap schedule, serve auto-match tie-break, splat penalty, ramp
  invariants, difficulty parameter monotonicity, bot score floor. Existing
  test names that survive (ticket generator, match matrix, patience/interval)
  keep their assertions.

---

## §G2. Controls-consistency standard + 27-game direction audit

### G2.1 The standard (binding for every game, current and future)

**Screen-space rule:** a swipe/drag/hold LEFT moves/steers the player-avatar
LEFT ON SCREEN; RIGHT → right; UP → up/jump; DOWN → down/slide. „On screen"
means the rendered pixels, never the logic/world axis. Corollaries:

1. Cameras looking down world **+z** render world +x on the **left** —
   any game with such a camera MUST mirror at exactly one boundary (input→
   logic or logic→render), never zero, never two.
2. Analog inputs (`p.nx`-driven) obey the same rule: `nx = +1` (screen
   right) must move the avatar to screen right.
3. Exemptions (documented, intentional): slingshot/pull-back aiming
   (miniGolf drag-back-to-shoot) and semantic swipes that name tricks rather
   than directions (trampoline) — these are NOT flips, but the trick/shot
   visual must still travel toward the swiped direction where applicable.
4. Every steer/lane game module exports `controls: { invertible: true }`
   (§G3.3); positional-input games export `invertible: false`.
5. New CI guard: each lane/steer game's `.logic.js` documents its
   screen-mapping in one line („render mirrors x: yes/no") and the build-wave
   checklist (§G10) verifies direction per game over CDP with a scripted
   swipe + screen-position assertion.

### G2.2 Audit method

Read every game's input handler + camera orientation (`camera.position` vs
`lookAt`): camera looking toward −z ⇒ world +x = screen right (standard
three.js); camera looking toward +z ⇒ world +x = screen LEFT. Then traced
input sign → logic axis → render position. Verified for this plan by direct
code reading of all 27 modules (+ carController); the build wave re-verifies
at runtime (§G10) because sign bugs are exactly the class that survives code
review.

### G2.3 The audit table (all 27 + shared controller)

| game | input style | camera looks | today's mapping | verdict | required fix (§G3) |
|---|---|---|---|---|---|
| carrotCatch | drag x → basket | −z | `targetX = nx·halfW` | ✅ correct | — |
| bunnyHop | tap = flap | −z | vertical only | ➖ n/a | — |
| **cityDrive** (all modes) | thumb zones via carController | chase cam along heading | left zone → `steer −1` → heading − → nose toward −x = **screen RIGHT** | ❌ **FLIPPED** | §G3.1-a |
| carrotGuard | tap-pick moles | −z | raycast | ➖ n/a (picks are screen-true) | — |
| goobySays | tap-pick pads | −z | raycast | ➖ n/a | — |
| memoryMatch | tap-pick cards | −z | raycast | ➖ n/a | — |
| basketBounce | flick throw | −z | `vel.x = vx·scale` | ✅ correct | — |
| gardenRush | tap/hold pots | −z | raycast/hold | ➖ n/a | — |
| pancakeTower | tap = drop | −z | timing only | ➖ n/a | — |
| burgerBuild | drag x → plate | −z | `targetX = nx·halfW` | ✅ correct | — |
| **shoppingSurf** | swipe lanes | **+z** | swipe left → lane−1 → x −1.6 rendered direct = **screen RIGHT** | ❌ **FLIPPED** | §G3.1-b |
| runner | swipe lanes | −z | left → lane−1 → −x = screen left | ✅ correct | — |
| veggieChop | drag trail (positional) | −z | `pt = nx·halfW` cut path | ✅ correct | `invertible: false` |
| **purblePlace** | buttons (rework §G1) | −z (rework) | button-driven | ➖ n/a | rework is §G2-safe |
| bubblePop | tap-pick | −z | raycast | ➖ n/a | — |
| **deliveryRush** | thumb zones via carController | chase cam | same as cityDrive | ❌ **FLIPPED** | §G3.1-a (shared fix) |
| fishingPond | tap timing | −z | timing only | ➖ n/a | — |
| danceParty | tap-pick pads | −z | raycast | ➖ n/a | — |
| miniGolf | drag-back aim | top-ish | pull-back slingshot („right drag → aim left", in-code comment) | ⚠️ intentional exemption | document; `invertible: false` |
| trampoline | swipe = trick names | −z | left=flip / right=spin / up=twist | ⚠️ semantic | verify flip anim rotates toward swipe side; `invertible: false` |
| goalieGooby | swipe angle → lane 0–4 | −z | dx<0 → lanes 0/1 = screen-left lanes | ✅ correct | — |
| starHopper | swipe / side-tap lanes | −z | left → lane−2 → −x = screen left | ✅ correct | — |
| pipeFlow | tap-pick tiles | −z | raycast | ➖ n/a | — |
| toyRacer | drag x → lateral | chase cam along fwd | spline `right = tangent×up` == chase-cam screen right; `steer = nx` | ✅ correct | — |
| ghostHunt | tap-pick | −z | raycast | ➖ n/a | — |
| rocketRescue | screen thirds → tilt | −z | right third → tilt + → +x = screen right | ✅ correct | — |
| **harborHopper** | drag x → boat target | **+z** | `dragX = nx·halfW` but +x renders screen LEFT | ❌ **FLIPPED** | §G3.1-c |
| goobyWelt (new §G6) | drag steer | forward along path | specced screen-true from day 1 | ✅ by spec | — |
| carController (shared: cityDrive trip/arcade/vet, deliveryRush) | zones + arrows + `setSteer` API | chase | positive steer → heading + → screen-left turn | ❌ **FLIPPED** (root cause of both drive rows) | §G3.1-a |

**Summary: 4 flipped surfaces today** — carController (⇒ cityDrive all
modes + deliveryRush), shoppingSurf, harborHopper. Exactly matches the owner
report („beim Fahren und beim Surf"). Everything else is correct, n/a
(tap/pick/timing), or an intentional documented exemption.

---

## §G3. Base-mapping fixes + „Steuerung invertieren" setting

### G3.1 The three fixes (do these FIRST; the invert setting layers on top)

**a) carController (fixes cityDrive trip + arcade + vet + deliveryRush).**
Root cause: positive yaw (`heading +`) turns a +z-facing car toward +x, which
a chase camera renders as a LEFT turn; the controller feeds `steer = right ?
+1 : −1` straight into `heading +=`. Fix at the application site, redefining
the API contract explicitly:

- Contract change: `setSteer(v)` — **v > 0 = steer screen/driver RIGHT**
  (heading DECREASES). Implementation: `heading += steerYawRate(−steerSmoothed,
  T.STEER_RATE, damp) · dt` (single negation inside carController; carFeel.js
  pure functions unchanged).
- Update BOTH autopilot call sites (cityDrive trip autopilot, deliveryRush
  bot) to negate their computed steering command, and the keyboard/zone
  handlers stay as-is (they already speak „left/right" semantically).
- laneAssist / collision / stuck-watchdog are heading-symmetric — untouched.
- New tests in `test/` (pure, via a headless heading integration):
  `steer=+1 for 1 s from h=0 ⇒ heading < 0`; autopilot convergence on a
  4-corner square route stays green (proves the double-negation didn't miss
  a site). §C7.3 invariants (trip rewards/energy/tow, vet math) bit-identical.

**b) shoppingSurf.** Fix at the logic→render boundary so logic space stays
intuitive („left" = screen left) for bot/validator/tests: introduce one
mapping helper in shoppingSurf.js — `const WX = (x) => −x` — applied at ALL
render sites (player `px`, player lean sign, obstacle `vis.position.x`, NPC
dotted-line x, coin instances, powerup positions, `camX`, floatText spawn).
Logic module untouched ⇒ all 1226 tests stay green unmodified. After the fix:
swipe left → `lane−1` → logic x −1.6 → world +1.6 → **screen left** ✅. The
NPC shopper then crosses screen right→left; rotate the rig 180° so it faces
its walk direction.

**c) harborHopper.** Analog input targets logic space directly, so mirror at
the input boundary (1 line): `this.dragX = −p.nx · HARBOR.CHANNEL_HALF_W ·
1.25`. Drag right → target −x → rendered at world −x = **screen right** ✅.
Nothing in the harbor world is chirality-dependent (waves/buoys/seagull are
symmetric); the logic bot passes `targetX` in logic space and stays
consistent. Add a comment block at the handler citing §G2.1 rule 1.

Sfx/haptics unchanged. Each fix ships with a CDP direction probe recording
(§G10) as PR evidence.

### G3.2 Regression guard

New shared test `test/controlsContract.test.js`: imports every game module's
static exports (no DOM — modules must keep side-effect-free module scope,
which they already do) and asserts `controls.invertible` is declared by all
27; plus per-game logic assertions where the mapping is pure (surf: lane
index → LANE_X monotone; carFeel: steerYawRate sign contract via the new
carController test). Runtime direction remains a §G10 CDP checklist item.

### G3.3 Global „Steuerung invertieren" accessibility setting

For players who PREFER inverted (e.g. „pull left to go right" flight-style):

- **Save slice [→A, save v4 §B]:** `settings.controls = { invertX: false,
  invertY: false }` (defaults false; migration adds the object losslessly).
- **Settings UI:** settings screen gains a „Steuerung" group under the volume
  sliders: two toggles — „Steuerung invertieren (links/rechts)" /
  „Invert controls (left/right)" and „…(hoch/runter)" / „…(up/down)".
  Strings module `strings/v4-controls.js` (EN+DE), keys
  `settings.controls.title|invertX|invertY|hint`. Hint line: „Gilt in
  Steuer-Spielen / Applies in steering games".
- **Mechanism:** the FRAMEWORK owns it (games stay dumb). In
  `framework.js` enter, when the launched module exports
  `controls.invertible !== false` and a flag is on, ctx.input is wrapped in a
  proxy that transforms ONLY directional payloads:
  - `swipe`: `dir` left↔right (invertX) / up↔down (invertY); `dx/vx` negated
    (invertX), `dy/vy` negated (invertY).
  - `drag/dragstart/dragend`: `nx/dx/vx` negated (invertX); `ny/dy/vy`
    negated (invertY). `x/y` client px stay raw.
  - `tap` and `pick()` pass through UNTOUCHED (picking must stay screen-true).
- carController doesn't use ctx.input (own DOM zones + keys), so
  cityDrive/deliveryRush pass `invertSteer: store.get('settings.controls.
  invertX')` into `createCarController` which swaps the zone/key semantic.
- Per-game `invertible` values: `false` for veggieChop, miniGolf, trampoline,
  and all pure-tap games (inverting taps/picks is nonsense); `true` for
  shoppingSurf, runner, starHopper, harborHopper, toyRacer, rocketRescue,
  goalieGooby, basketBounce, carrotCatch, burgerBuild, goobyWelt (+ the two
  car games via the param).
- Harness: `?invertx=1 ?inverty=1` set the toggles for a session (dev only).
- Tests: proxy transform table (pure function `invertPayload(event, p,
  {x,y})` exported from framework or a small `core/inputInvert.js`), and one
  game-level test (surf: inverted swipe left ⇒ lane+1).

---

## §G4. Shopping-Surf speed-feel juice package

Problem: §C8.5's ramp (8 → 16 m/s) exists in the numbers but the player
doesn't FEEL it — the camera/FOV are static, scenery density is constant, and
only the turbo powerup kicks the FOV. Package (all numbers binding; visuals
render-only, zero logic changes, tests untouched):

**G4.1 FOV kick (speed-scaled).** `fov = 62 + 10 · clamp((speed − 8)/(16 −
8), 0, 1)` (62 at base → 72 at cap), lerped at k = 5/s; the existing turbo
kick becomes ADDITIVE (+8) on top, hard cap 78. Projection matrix updated
only when |Δfov| > 0.01 (existing pattern).

**G4.2 Speed-line particles.** Source: Brackeys' VFX Bundle light-streak
textures (CC0, staged in `/workspace/asset-staging/itchio/`), 2 curated
streaks committed to `public/assets/vfx/streak_a.png|streak_b.png` (≤ 20 KB
each, white-on-alpha, tint via material color `#FFF6EC` at 0.55 opacity,
additive blending). Pool of 24 billboards (one shared geometry+material,
per-instance via 24 sprites — cheaper than a custom shader here). Spawn rate:
0/s below 10 m/s → 6/s at 12 → 14/s at 16 (linear segments); spawn in a ring
at screen edge (world: radius 3.2–4.2 m from camera axis, 4–9 m ahead),
velocity −z at 1.6× run speed, life 0.35 s, scale 0.06×1.4 m stretched along
motion. Despawn on life end; pool exhaustion drops spawns silently.

**G4.3 Top-speed camera shake.** Continuous micro-jitter when speed ≥ 15
m/s: amplitude 0.035 m (x/y), re-randomized per frame, ADDED to the existing
crash-shake term (crash shake still dominates at 0.16+). Fades in over the
15 → 16 m/s band so it never pops.

**G4.4 Ground-scroll rate.** The road/sidewalk planes get a subtle repeating
texture (procedural 64×64 canvas: pavement seams every 16 px) with
`map.offset.y −= (speed · dt) / 4` so the ground itself communicates speed
(today only lane dots + scenery move). One texture, both planes; respects
the existing disposables registry.

**G4.5 Wind audio layer.** New sfxMap id `ambience.windRun` (Kenney
impact/whoosh loop or synth-noise recipe). Game starts it via
`audio.play('ambience.windRun')` at run start, stops in dispose. Intensity:
gain mapped `speed 10 → 16 m/s ⇒ 0 → 0.5` (updated every 0.25 s).
**[→A]** contract: plan A's audio §C-SYS exposes `audio.setLoopGain(id, 0…1)`
(no-op when the loop isn't playing, zero nodes while music-muted per §B2).
If A descopes the helper, fallback (specced, not TBD): re-trigger a 2 s
whoosh sample at speed thresholds 12/14/16 instead — banner sync below still
carries the feel.

**G4.6 Near-miss slow-mo flash.** On each `nearMiss` logic event: game-local
timescale 0.55 for 0.18 s REAL time (implemented by scaling the dt passed to
`stepRun` and all visual updates — logic stays deterministic since dt is an
input), plus a white 8 %-opacity full-screen DOM vignette flash for 0.12 s,
plus the existing „Knapp!" float. Never stacks: a new near-miss during
slow-mo only refreshes the timer.

**G4.7 Milestone banners.** `hud.banner` + `combo.up` sting at first
crossing of 10/12/14/16 m/s: „Schneller! 🔥" (DE) / „Speed up! 🔥" (EN); at
16: „VOLLGAS!!" / „TOP SPEED!!". Every 250 m in arcade mode: „250 m!" etc.
(existing banner queue handles collisions). Strings in `strings/v4-surf.js`.

**G4.8 Runner-class rollout (reduced dose).**
- `runner`: FOV 60 → +8 over its speed band, streak pool 16, shake at top
  speed 0.03, banners at its own ramp thirds.
- `toyRacer`: FOV +6 during drift-boost only, streaks during boost (rate 10/s
  for the boost duration), no continuous shake (kart bob exists).
- `harborHopper`: FOV +6 during wave surf-boost, spray particles already
  exist — add 8-streak burst on boost start.
- cityDrive/deliveryRush keep §C7.2's speed-FOV (55→60) — no extra shake
  (motion-comfort ruling §C7.2 stands).

Perf gate: juice adds ≤ 30 draw calls worst case in surf (24 sprites + 2
planes retint + vignette DOM); §C8.7's ≤ 250 total still holds (§G10 check).

---

## §G5. Difficulty system (Leicht/Mittel/Schwer) + ENDLOS

### G5.1 Scope

- **Difficulty-enabled: 26 games** — all score-based arcade games including
  deliveryRush and both flagships, plus the four §C10.1 games.
- **Excluded:** `cityDrive` (all its modes ride trip/§C4 semantics and the
  shared controller tuning; changing its speeds would leak into trip
  invariants — its arcade run stays single-difficulty), `goobyWelt` (§G6 —
  chill special, own structure), travel/trip launches of any game
  (shopTrip drive, vet drive, surf „Laufen": launched by the trip machine,
  never through the pre-game screen), `_smoke` (dev).
- Difficulty NEVER changes coin-row constants, energy costs, unlock levels,
  meta shapes, or quest/achievement event vocabularies.

### G5.2 The four modes

| mode | id | availability | params | coins |
|---|---|---|---|---|
| Leicht | `easy` | always | family table ×easy | row result × **0.7** (floor: row min) |
| Mittel | `normal` | always (default) | current live numbers, bit-identical | row result × **1** |
| Schwer | `hard` | always | family table ×hard | row result × **1.3**, capped at row max |
| Endlos | `endless` | per-game after BEATING Schwer (§G5.5) AND level ≥ 10 | Schwer params + no duration end + extended ramp | **flat 5 c** per run (daily ×2 applies) |

Coin math (single site — `economy.awardMinigame` gains a `difficulty`
option): `coins = min(row.max, round(rowClamp(score) · mult))` then daily ×2
(after, as today). Endless passes `coinsOverride: 5`. **[→A]** economy.js is
systems-owned; the game side passes `params.difficulty` through the framework
launch params and the framework forwards it into awardMinigame.

### G5.3 Parameter families (multipliers applied INSIDE each game's logic)

Each `.logic.js` gains `applyDifficulty(tune, mode)` returning a derived
frozen tune object (base tables stay frozen/exported for tests). Families:

| family | games | Leicht | Schwer |
|---|---|---|---|
| **runner/steer** | shoppingSurf, runner, toyRacer, harborHopper, deliveryRush | speed ×0.85, obstacle/spawn density ×0.85, +1 crash allowance | speed ×1.2 (surf cap 16→18), density ×1.15, crash allowance unchanged |
| **timed arena** | carrotCatch, carrotGuard, veggieChop, bubblePop, ghostHunt, gardenRush, burgerBuild, goalieGooby, basketBounce, fishingPond | spawn interval ×1.2, reaction/telegraph windows ×1.25, duration +20 % | spawn interval ×0.85, windows ×0.8, duration unchanged |
| **sequence/puzzle** | memoryMatch, goobySays, danceParty, pipeFlow, starHopper | replay/preview speeds ×0.85, timing windows ×1.25 | replay speeds ×1.15, windows ×0.8, ramp floor −1 step |
| **physics/skill** | trampoline, pancakeTower, rocketRescue, bunnyHop, miniGolf | tolerances ×1.25 (overhang, landing v, gate gap, par +1) | tolerances ×0.8 (min: never below 0.55× of Mittel — beatability), par unchanged |
| **assembly** | purblePlace | §G1.6 row | §G1.6 row |

Guardrails (owner: games must stay BEATABLE): Schwer window/tolerance
multipliers never push a reaction window below 0.35 s or a hitbox below 55 %
of Mittel; runner-family Schwer keeps the §C8.7-style never-impossible
validator running against the SCALED speeds (validator param, existing BFS).

### G5.4 Per-game rows (Schwer beat-target + Endlos end-condition)

Beat-target rule: ≈ 80 % of the coin-cap score (`divisor × max`), rounded to
a friendly number, sanity-clamped by documented typical scores (PLAN3
§C8.5/§C9.4/§C10.1). „Beat Schwer" = finish a Schwer round with
`score ≥ target`. Verified beatable when the game's autoplay bot reaches the
target on Schwer in ≥ 1 of 5 seeded runs (plan C eval gate; if the bot
can't, the PARAMS are relaxed, never the target raised).

| game | cap-score | Schwer-Ziel | Endlos end-condition |
|---|---|---|---|
| carrotCatch | 75 | 70 | 3 carrots hit the ground (cumulative) |
| bunnyHop | 50 | 45 | already run-until-crash → endless = no gate cap, wind always on |
| carrotGuard | 75 | 70 | 3 carrots stolen |
| goobySays | 120 | 70 | already until-fail → endless = replay speed keeps ramping past the floor |
| memoryMatch | 48 | 40 | boards chain; 12 cumulative miss-flips end it |
| basketBounce | 78 | 65 | 3 consecutive misses |
| gardenRush | 75 | 65 | 3 withered pots |
| pancakeTower | 52 | 45 | already until-topple → endless = wobble never damps below stage-8 level |
| burgerBuild | 104 | 85 | 3 expired orders |
| shoppingSurf | 1360 | 900 | 3 crashes (as arcade) but speed ramp continues to 20 m/s, density cap ×1.5 |
| runner | 450 | 380 | 3 crashes, ramp uncapped to +40 % |
| veggieChop | 130 | 105 | 3 junk hits |
| purblePlace | 150 | 120 | 3 rejected/expired cakes end it; interval floor 10 s |
| bubblePop | 96 | 80 | 3 spiky-bubble pops |
| deliveryRush | 256 | 200 | 3 expired parcels |
| fishingPond | 78 | 65 | 3 line breaks/boots |
| danceParty | 168 | 140 | 3 full combo breaks (missed section) |
| miniGolf | 140 | 110 | holes loop; 3 over-par holes end it |
| trampoline | 130 | 105 | 3 failed landings |
| goalieGooby | 78 | 65 | 3 goals conceded (endless shot stream) |
| starHopper | 234 | 190 | already until-crash → ramp uncapped, wormholes rarer |
| pipeFlow | 125 | 100 | 3 unsolved/leaked puzzles |
| toyRacer | 180 | 150 | lap chain (race restarts back-to-back); ends when finishing a race worse than 2nd |
| ghostHunt | 112 | 90 | 3 escaped Boo-waves (< 4 catches) |
| rocketRescue | 140 | 115 | fuel runs out (fuel pickups thin out −10 %/platform) |
| harborHopper | 150 | 110 | 3 bumps (buoy/pier hits) |

Endless scoring = the game's normal scoring, accumulating without the round
timer; `hud.setTime` shows elapsed-up. Endless runs still emit normal §B3
meta (quests/achievements count them like any round).

### G5.5 Unlock & persistence (save slice — shape owned here, save v4 [→A])

```
minigames: {
  best, plays, lastPlayDay,                    // existing, untouched — `best` stays the Mittel board
  difficulty: { [gameId]: 'easy'|'normal'|'hard' },   // last-selected per game (endless not persisted as selection)
  beaten:     { [gameId]: { easy: true?, normal: true?, hard: true? } },  // set when score ≥ target on that mode (targets per §G5.4; easy/normal targets = same number — they're „cleared" markers for the pre-game UI ticks)
  bestByDiff: { [gameId]: { easy: n?, hard: n? } },   // Leicht/Schwer highscores (Mittel stays in `best`)
  endlessBest: { [gameId]: n },                       // per-game endless highscore (local only)
}
```

- ENDLOS pill enabled iff `beaten[id].hard && level ≥ 10`; locked pill shows
  „🔒 Schlage Schwer (Ziel N) · ab L10".
- `best` (Mittel) remains what ribbons/quests/results „Best" use — zero
  migration risk for existing features; Leicht/Schwer/Endlos boards are
  additive UI.
- Migration v3→v4 adds the four empty objects (lossless, [→A]).
- Harness: `?difficulty=easy|normal|hard|endless` forces the mode for
  `?minigame=` launches (dev only, bypasses the endless lock like `?minigame=`
  bypasses level locks).

### G5.6 Pre-game screen (new UI screen `mgPregame`)

Replaces direct tile→launch (arcade taps open it; trips/harness/tutorial
launch directly as today):

- Layout (portrait, 320–430 px): cover art card top (§G7, width min(86vw,
  22rem), 4:3), game name (1.25 rem, 800), under it the info row: coin range
  `🪙 min–max`, energy `⚡ n`, best-of-selected-mode.
- **Difficulty segmented control**: 4 pills (Leicht/Mittel/Schwer/Endlos ∞),
  3rem tall, full card width; selected = teal fill; Endlos shows the lock
  state per §G5.5. Below: per-mode line — Leicht „×0,7 Münzen", Mittel „×1",
  Schwer „×1,3 · Ziel: N", Endlos „5 Münzen · Highscore ∞: M". Selection
  persists to `minigames.difficulty[id]`.
- **Modifier banner** (§G8, [→A]): when plan A's modifier system has an
  active modifier applying to this game: glowing banner (2.75rem) with the
  modifier icon, name, „noch N Spiele" remaining-plays counter, and the
  §G8 glow treatment.
- **Play button**: full-width, 3.5 rem, `btn-teal`, „Spielen ▶"; fires
  `framework.launch(id, { difficulty })`. Back arrow top-left returns to the
  arcade grid (arcade screen stays mounted underneath — mgPregame is a
  stacked screen like vetPanel).
- Endless results: the framework results screen gains one extra row in
  endless mode — „Endlos-Best: M" with `newBest` badge on improvement, and
  writes `endlessBest`. Strings module `strings/v4-difficulty.js` (EN+DE:
  mode names, target lines, lock line, endless rows).

### G5.7 Framework plumbing (game-side; small, listed exhaustively)

1. `framework.launch(id, params)` accepts `params.difficulty` (default
   `'normal'`), validates the endless lock, stores it into `lastResult` for
   the results screen, forwards to `awardMinigame` and into `ctx.params`.
2. Games read `ctx.params.difficulty` and call their
   `applyDifficulty(TUNE, mode)` at init; bots must play any mode (bots read
   the derived tune from the run state — they already do).
3. `hud.setTime` in endless counts up (games pass elapsed; framework
   renders as-is — no change needed beyond games' own calls).
4. `beaten`/`bestByDiff`/`endlessBest` writes happen in
   `economy.awardMinigame` (single persistence site, [→A] one-function
   change with the shape above).

---

## §G6. GOOBY WELT — Gaussian-splat special game

### G6.1 Concept & identity

`goobyWelt` — „Gooby Welt / Gooby's World". Gooby floats through a REAL
photogrammetry world (Gaussian splats) collecting stars and carrots along a
designed path. Chill exploration, no fail state, 110 s runs. SPECIAL arcade
tile marked „SPECIAL — echte 3D-Welt!" (§G7.4). Unlock **L12**. Renderer +
scenes per the D2 feasibility recipe (`/workspace/asset-staging/splats/
REPORT.md`, `/opt/cursor/artifacts/gooby_welt_feasibility_report.md`):
`@mkkellogg/gaussian-splats-3d@0.4.7` (MIT), DropInViewer inside the normal
§E8 minigame scene, splat = visual-only, gameplay on invisible colliders.

### G6.2 Scenes shipped (2) + attribution [→A]

| scene id | file (→ `public/assets/splats/`) | size | source (CC BY 4.0) |
|---|---|---|---|
| `windmill` | `windmill-golden-gate-mobile.compressed.ply` | 15.5 MB | „S Windmill in Golden Gate Park" — azadbal, superspl.at/scene/d5f14e49 |
| `townsquare` | `ludlow-quality-square-mobile.compressed.ply` | 15.5 MB | „Ludlow - Quality Square" — ijenko, superspl.at/scene/ca36efcc |

(Ludlow chosen over Avoncroft per the report's „walk into another world"
recommendation; Avoncroft stays staged as reserve.) Copy each scene's
`LICENSE-NOTE.md` alongside as `public/assets/splats/<id>.LICENSE.txt`.
**[→A] credits screen** must render both attributions verbatim incl. license
link + „modified: decimated to 1M splats, SH0" (CC BY 4.0 change-indication
requirement). **[→A] asset ledger:** +31 MB pushes the committed repo to
≈ 59 MB — plan A raises the ledger test to warning 65 / hard 80 MB for 4.0
(with the splat files listed as the justification) BEFORE this game's asset
commit lands; §G7 covers add ≈ 2.3 MB more.

### G6.3 Camera, controls, movement

- Per-scene authoring data (from the proof project): scene rotation/up
  correction (Ludlow needs mirrored Y + `camera.up.y = −1` handling per the
  recipe — bake the correction into a per-scene `orientation` quaternion in
  the path JSON instead of touching camera.up so the §E8 camera stays
  framework-standard), start pose, and the path spline.
- Movement: auto-forward along an authored Catmull-Rom **path spline** at
  **1.6 m/s** (scene scale as-authored); drag steers a lateral/vertical
  offset around the spline: `offsetX ∈ [−2.5, +2.5] m`, `offsetY ∈ [−1.0,
  +1.8] m`, drag sensitivity 2.2 m per screen-width, offset eased at k = 6/s,
  **drag right = move screen right** (§G2 by construction: camera looks along
  the path tangent; offset applies in camera space).
- Gooby: the existing procedural rig (createGooby, outfits applied) at scale
  0.55, floating 2.2 m ahead of the camera at the offset point, gentle
  bob ±0.06 m at 0.4 Hz, `happyBounce` loop. Camera = spline point + tangent
  frame, FOV 58.
- Run = one full path traversal: paths authored to take **110 s ± 5** at
  1.6 m/s (i.e. ≈ 176 m of spline). HUD time counts down from 110; reaching
  the end early is impossible (fixed speed), banner „Geschafft! ✨" at the
  finish gate.

### G6.4 Pickups & scoring (chill, discovery-flavored)

- **Stars ×28** per scene: +2 each. Placed at path points every ≈ 5–6 m,
  lateral offsets ≤ 2 m, alternating sides, arcs of 3–5 teaching vertical
  drift. **Carrots ×6**: +5 each, placed at „discovery spur" spots (behind
  the windmill sails, under the Ludlow archway, …) needing full lateral or
  vertical offset.
- **Foto-Spots ×3** per scene: invisible trigger spheres r = 3 m at scenic
  landmarks; entering fires a camera-flash vignette + shutter sfx + „Toller
  Ausblick! +10". +10 each.
- Finish bonus +10. Max = 28·2 + 6·5 + 3·10 + 10 = **126**; typical relaxed
  run ≈ 80–100.
- Collision: pickups are simple sphere colliders (r 0.9 m) against Gooby's
  position — pure math in `goobyWelt.logic.js`; NO collision with the splat
  world (path authored to never intersect geometry; offsets clamped inside
  an authored per-segment „corridor" half-width table so players can't fly
  into walls).
- **Coin row (modest, [→A] one-time constants row):** `{ divisor: 6, min: 4,
  max: 20 }`, energy 8. Meta `{ stars, carrots, fotoSpots, sceneId }`;
  counters `weltRuns`, `weltStars` (achievement/sticker hooks for plan A's
  content pass). No difficulty modes, no modifier participation (§G8
  excludes special games), no endless — per-scene highscore chips on the
  pre-game screen instead (`best` keyed as today; scene shown in results
  subtitle).

### G6.5 Pickup-layout authoring methodology (how the build agent places them)

1. Dev harness route `?minigame=goobyWelt&scene=<id>&flycam=1`: WASD/drag
   free-fly + `P` dumps `{pos, look}` JSON to console.
2. Author the spline: fly the intended route, dump 25–40 waypoints, store as
   `src/minigames/games/goobyWelt.paths.js` (pure data: waypoints, corridor
   half-widths, star/carrot/fotoSpot lists, orientation quaternion, ambient
   tint per scene).
3. Validate in logic tests: spline length 165–185 m, min corridor 1.2 m, all
   pickups within corridor + reach, no two stars < 2.5 m apart, foto-spots
   ≥ 25 m apart.
4. Screenshot pass over CDP at 6 fixed spline t-values per scene for the PR.

### G6.6 Performance & lifecycle guards (from the recipe, binding)

- DropInViewer options VERBATIM from the report (sharedMemory false, GPU sort
  false, SIMD sort true, integer sort true, SH0, compression 2,
  freeIntermediateSplatData true, reveal Instant); `addSplatScene` with
  `splatAlphaRemovalThreshold: 5, showLoadingUI: false, progressiveLoad:
  false`.
- **Pixel ratio 1** while the game runs (save + restore renderer PR on
  init/dispose). Quality fallback toggle on the pre-game screen: „Qualität:
  Schön / Flüssig" → `settings.goobyWeltQuality: 'high'|'low'` [→A save];
  low = renderer pixel ratio 0.75, camera far 60 (vs 90), star glow sprites
  off.
- **Async lifecycle hardening (prerequisite work item, framework-owned):**
  `framework.js` awaits `game.init(...)`; scene `dispose` may return a
  Promise and the framework + `sceneManager.switchTo` await it (recipe step
  4). Existing sync games unaffected (awaiting undefined). This lands BEFORE
  goobyWelt [→C ordering].
- Loading UX: `init` awaits the splat load (2–9 s measured) — show a DOM
  loading card („Betrete die echte Welt… ⏳" + scene name + progress dots)
  over the countdown-blocked stage; the framework countdown starts only
  after init resolves (already true — countdown runs post-enter).
- `onPause`/`onResume`: toggle `splats.visible` (suppresses sort work).
- `dispose()` async: unsubscribe input, stop timers, `await
  splats.dispose()`, remove viewer, restore pixel ratio, null refs. NEVER
  cache a viewer across rounds; context-loss → clean exit to results with a
  toast (recipe caveat).
- Load-failure fallback: catch → swap in the low-poly fallback stage (sky
  dome + 12-tree Kenney nature arrangement along the same spline data) so
  the round still plays; toast „3D-Welt konnte nicht laden".
- iOS notes carried into the module header: 1M ceiling, one scene resident,
  no shadows, test 10 enter/exit cycles for memory growth (§G10 + plan C
  eval gate on the iOS packaging check).

### G6.7 Purity & bot (CI)

`goobyWelt.logic.js`: spline eval (Catmull-Rom, arc-length table), offset
clamping vs corridor, pickup sphere tests, scoring, run timer — all pure;
`goobyWelt.paths.js` is pure data (tests validate §G6.5 rules). Bot
(`?autoplay=1` + CI): follows the spline at zero offset, steers offset toward
any pickup whose corridor-projected distance < 2 m ahead — deterministic,
collects ≥ 60 % of stars, score ≥ 45 guaranteed; logs
`[autoplay] goobyWelt score=… stars=…/28`. Draw calls ≤ 120 + splat viewer.

---

## §G7. Cover arts + arcade tile redesign + pre-game screen visuals

### G7.1 Cover-art assets (coordinator-generated, pre-wave)

- **28 PNGs** → `public/assets/covers/<gameId>.png` (27 games + `goobyWelt`;
  `_smoke` excluded). Spec per file: **512×384 (4:3)**, palette-quantized
  PNG ≤ 85 KB (target total ≤ 2.3 MB, [→A] ledger).
- Style guide for generation (consistency contract): cozy pastel 3D-render
  look matching the game's world palette (§C10.1 distinct-look table);
  Gooby — the cream-colored, pear-bodied, tall-eared pet (reference:
  `shots/boot_home.png` + `?scene=gooby` captures) — featured mid-action in
  every cover; soft rim light, cream `#FFF6EC` vignette corners, NO text in
  the image (names render as DOM). One prompt template per game listing:
  scene (e.g. purblePlace = warm bakery, conveyor, cake pans), action, 2–3
  palette hexes. goobyWelt cover: Gooby flying over a photoreal windmill
  park (mark „SPECIAL" flavor via a subtle sparkle frame).
- Fallback rule: a missing/unloadable cover falls back to the current
  icon-tile look (never a broken image); `onerror` swaps in the tinted icon
  block. Covers are UI assets (CSS `background-image`), NOT run through
  `core/assets.js`.

### G7.2 Arcade grid — bigger cover cards (binding layout)

- Grid: **2 columns ALWAYS** (replaces 3-col + §C1.2 narrow rule for this
  screen), `gap 0.75rem`, max-width 27.5rem, screen padding as today.
- Tile = vertical card: cover (4:3, `border-radius 1rem 1rem 0 0`,
  `object-fit cover`) + name row (0.8125rem, 800, 2-line clamp) + info row
  (best score `★ N` left; for endless-unlocked games `∞ M` right) —
  card `border-radius 1.25rem`, existing card shadow.
- Computed tile sizes: 320 px viewport → tile ≈ 141 px wide, cover 141×106;
  393 px → 174/131; 430 px → 191×143. At 130 % uiScale the grid stays 2-col
  (rem-scaled paddings shrink the cover, min cover height 88 px guarded by
  clamping the grid max-width). Verify at the §C1.3 matrix.
- Overlays (all existing semantics kept, restyled onto the cover):
  - lock: dim cover 55 % brown + 🔒 + „ab Level N" centered;
  - NEU ribbon (§C10.3 rules unchanged) top-right rotated pill; the
    flagship wide-tile treatment RETIRES (covers make every tile loud) —
    `g48-flagship` span-2 CSS removed, ribbon logic kept;
  - **modifier glow** [→A]: when plan A's modifier targets the game, the
    card gets `box-shadow: 0 0 0 3px var(--modifier-color), 0 0 14px
    var(--modifier-color)` pulse (2 s ease) + a small modifier icon chip
    bottom-right of the cover + „×N" if it multiplies rewards;
  - goobyWelt special: gold-dashed 2 px border + „SPECIAL — echte
    3D-Welt!" ribbon (replaces NEU ribbon for this tile, permanent until
    first play).
- Tap → `ui.showScreen('mgPregame', { gameId })` (§G5.6). Coming-soon/dev
  states unchanged.

### G7.3 Pre-game screen visual spec (completes §G5.6)

Cover large at top: width min(86vw, 22rem), 4:3, radius 1.25rem, subtle
parallax tilt on device-less hover skipped (no gyro dependency). Under the
difficulty control: coin/energy row and the §G8 modifier banner. The screen
uses `pushContext('arcade')` music (already active from the arcade). Loading
of the cover is instant-from-cache (same file as the tile).

### G7.4 Strings

`strings/v4-arcade.js`: `arcade.special.ribbon` („SPECIAL — echte 3D-Welt!" /
„SPECIAL — real 3D world!"), `pregame.play`, `pregame.target`,
`pregame.endlessLocked`, `pregame.quality.*` (goobyWelt toggle), mode names
(shared with `v4-difficulty.js` — difficulty owns them; arcade module only
adds what's listed here). EN+DE for every key.

---

## §G8. Modifier integration contract (engine is plan A's)

Game-side obligations only; the modifier engine, its catalog, activation and
persistence are PLAN4.md §C-SYS [→A]:

1. **Pre-game screen** (§G5.6) renders the active-modifier banner from a
   read-only accessor: `modifiers.getActiveFor(gameId)` → `null | { id,
   icon, nameKey, color, remainingPlays, coinMult?, effectKey? }`. Banner =
   glow chip + name + „noch N Spiele".
2. **Arcade tile** (§G7.2) renders the glow from the same accessor (single
   source of truth; no game-side state).
3. **Results screen**: when the finished round consumed a modifier, the
   framework result gains one row: „Bonus: <name> +X 🪙" (the framework
   receives `reward.modifierBonus` from `awardMinigame` — the economy applies
   the multiplier INSIDE the single payout path, [→A]). Order of operations
   fixed here so both plans agree: row clamp → difficulty mult (§G5.2) →
   modifier mult → row max cap → daily ×2.
4. Modifier effects that change GAMEPLAY (not just coins) are out of scope
   for 4.0 games (contract: coin-side only) — nothing in any `.logic.js`
   reads modifier state.
5. goobyWelt and travel/trip launches are excluded from modifiers (accessor
   returns null for them by catalog rule, [→A]).

---

## §G9. Game-side content: rooms, food values, new foods

### G9.1 Room-dressing polish pass (static decor, NOT catalog furniture)

Rules: additions are static room dressing (no save/catalog changes), ≤ 4 new
draw calls per room (merge/instance), metalness-normalized, kept clear of
anchor/interaction zones, and disposed via each room def's existing owned
lists. Sources: itch.io CC0 packs staged in `/workspace/asset-staging/itchio/`
(Aline Furniture GLBs, Tiny Treats glTF) + committed Kenney furniture-kit.
Copy list lands under `public/assets/itch/<pack>/…` with per-pack
LICENSE-NOTE (CC0 — no credits requirement, still shipped for provenance).

| room | additions (exact) |
|---|---|
| kitchen | wall trim: procedural 0.12 m molding strip around 2 walls tinted `#E8D5C0` (1 merged mesh); „Purble-Bäckerei-Ecke": Tiny Treats `display case` + `mixer` + macaron plate trio on the counter (ties the §G1 bakery into the home; Nougatschleuse stays untouched); hanging-utensils strip over the stove (1 merged mesh) |
| living | Aline `bookshelf` (with baked-in books) against the back wall; 2 framed pictures (0.5×0.4 m canvas-texture frames showing 2 sticker-book artworks — reuse committed sticker PNGs); Aline `plant` corner pot |
| bathroom | wall trim (same recipe, tint `#D9E8E4`); towel rail + 2 pastel towels (procedural, 1 mesh); small Aline `cactus` on the shelf |
| bedroom | rug (Aline `rug` GLB under the bed); fairy-light string: 14 emissive dots on a droop curve (1 mesh, bunting-style recipe from surf); 1 framed picture (sticker art) |
| garden | (already dense from v2/v3) only: 2 extra `flower_purpleA` clusters + Tiny Treats picnic `basket` near the bench — nothing else, keep draw calls |

Acceptance: before/after screenshot per room (5 pairs) at 393×852; room
draw-call delta logged in the PR (≤ +4 each).

### G9.2 Showing hunger/fun values (fridge tray + shop)

- Fridge tray items (`interactions.js` tray grid): each `.tray-item` gains a
  value chip row under the emoji: `+N 🍗` (hunger) and `+N 🎲` (fun),
  0.625rem, brown 70 % — only non-zero deltas shown, max 2 chips (energy/
  hygiene stay hidden here to avoid clutter; the careSheet keeps full data).
  Junk belly-icon band unchanged.
- Shop food cards (`shopScreen.js` renderFood): same chips inline after the
  price row. Values read from `FOODS[i].deltas` — display-only, no data
  changes. Icons reuse `icon('hunger')`/`icon('fun')` at 12 px instead of
  emoji if the icon set reads better at 85 % scale (build agent picks ONE,
  applies to both surfaces).

### G9.3 New foods (3, from Tiny Treats „Baked Goods" CC0)

Catalog additions to `data/foods.js` (33 → 36; static catalog — no save
impact; shop auto-lists):

| id | name EN / DE | price | deltas | junkScore | model |
|---|---|---|---|---|---|
| `croissant` | Croissant / Croissant | 12 | hunger +14, fun +4, energy +2, hygiene −1 | low | `itch/baked-goods/croissant` |
| `cupcakePink` | Pink Cupcake / Rosa Cupcake | 14 | hunger +10, fun +10, energy +2, hygiene −2 | mid | `itch/baked-goods/cupcake` (pink tint variant) |
| `cinnamonRoll` | Cinnamon Roll / Zimtschnecke | 16 | hunger +16, fun +8, energy +3, hygiene −2 | mid | `itch/baked-goods/cinnamon-roll` |

Feeding flow/animations unchanged (foods are data + a model key). glTF+BIN
converted to GLB in the asset pass; ≤ 60 KB each. Strings in
`strings/v4-foods.js` (EN+DE names).

---

## §G10. Game bug-sweep checklist (build-wave acceptance, per game)

Every game agent runs this list against each game they touch and logs the
outcome (bug fixed / clean bill) in the PR — same discipline as §C10.2:

1. **Input direction** — CDP probe: scripted swipe/drag LEFT must move the
   avatar LEFT in screen pixels (assert via `Runtime.evaluate` on the
   avatar's projected screen x before/after). For §G3-fixed games attach the
   probe output as PR evidence. Known-red today: cityDrive, deliveryRush,
   shoppingSurf, harborHopper (fixed by §G3.1); purble drop-control fixed by
   the §G1 rework.
2. **Pause safety** — pause mid-action (mid-jump/mid-drop/mid-bake), wait
   3 s, resume: no double timers, no teleport, no duplicated audio; clock
   games rebase (`onPause`/`onResume` hooks where real-time clocks exist).
3. **Dispose discipline** — enter → play 5 s → exit → repeat ×3:
   `renderer.info.memory.geometries/textures` returns to the between-runs
   baseline; no listener leaks (`getEventListeners` on canvas/window via
   CDP); goobyWelt additionally: 10 cycles, splat viewer fully released
   (§G6.6).
4. **Results correctness** — final HUD score == results score == logic
   score; coins == coin-row math for the played difficulty (§G5.2 order of
   operations); endless run writes `endlessBest` only when improved.
5. **Difficulty params sane** — bot mean score over 10 seeded runs is
   monotone: easy ≥ mittel ≥ schwer; schwer target reachable (§G5.4 gate);
   no derived tune value violates the §G5.3 guardrails (unit-tested per
   game).
6. **Layout** — 320×568, 393×852, 430×932 at uiScale 100 + 130: no control
   overlaps HUD/pause; §G1.7 and §G5.6/§G7.2 pixel specs hold.

---

## §G11. Dependencies & ordering for plan C

Build-order constraints (game-side view; plan A's §B save v4 + economy +
modifier accessor are external prerequisites where marked):

1. **Foundation (before any game wave):**
   a. framework async `init`/`dispose` hardening (§G6.6 — safe no-op for all
      existing games, unblocks goobyWelt);
   b. §G3.1 direction fixes (small, independent, huge owner-visible win);
   c. §G3.3 invert setting + `controls.invertible` exports (needs [→A]
      `settings.controls` in save v4);
   d. difficulty plumbing (§G5.7) + pre-game screen skeleton (§G5.6) +
      2-col cover grid (§G7.2 — ships with icon-fallback tiles even before
      cover PNGs exist);
   e. [→A] prerequisites consumed here: save v4 slice (§G5.5, §G3.3,
      §G6.6 quality), `awardMinigame` difficulty/modifier/beaten writes,
      ledger cap raise (§G6.2), `audio.setLoopGain` (§G4.5, optional),
      modifier accessor (§G8), credits attributions (§G6.2).
2. **Game waves (parallelizable by file ownership):**
   - Team CAKE: §G1 purble rework (purblePlace.js + .logic.js + tests) —
     biggest single item;
   - Team SURF: §G4 juice + §G3.1-b flip (same files — one agent);
   - Team WELT: §G6 (needs 1a, npm dep, splat assets, paths authoring);
   - per-family difficulty rows (§G5.3/§G5.4 `applyDifficulty` + endless
     end-conditions) split across 3–4 depth agents like §C10.2's batches;
   - §G9 content agent (rooms/foods/value chips — independent).
3. **Assets pre-wave (coordinator):** 28 cover PNGs (§G7.1 style guide), 2
   splat PLYs + licenses, itch.io copies (Tiny Treats bakery/baked-goods
   subset, Aline 4 GLBs, 2 VFX streak textures).
4. **Eval charters plan C should cut:** controls-direction eval (CDP probes,
   all steer games + invert toggle), purble-authenticity eval (belt control,
   drop timing, oven, multi-pan vs §G1), difficulty/economy eval (multiplier
   order, targets, endless lock incl. L10 gate), splat eval (load/dispose/
   10-cycle memory, quality toggle, fallback), covers/layout eval (§C1.3
   matrix on arcade + pregame), plus the §G10 sweep verdicts.
5. **Test-count expectation:** existing 1226 stay green unmodified except
   purblePlace suites (rewritten with §G1.9 coverage — assertion parity list
   in §G1.9) and carController steer-sign tests (§G3.1-a adds, none change).

---

*End of PLAN4-GAMES.md — plan agent B. Companion: PLAN4.md (§A/§B/§C-SYS,
plan agent A) and plan agent C's wave/eval plan.*

