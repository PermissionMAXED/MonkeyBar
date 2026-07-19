# public/assets/covers/ — arcade cover art (PLAN4-GAMES §G7.1)

Coordinator-owned AI art (ART-GATE-3, pre-wave-4) — **no build agent
generates art**. 28 PNGs land here as `<gameId>.png` (27 games + `goobyWelt`;
`_smoke` excluded):

- 512×384 (4:3), palette-quantized PNG ≤ 85 KB each, target total ≤ 2.3 MB
  (ledger cap: covers ≤ 3 MB in `test/assetBudget.test.js`).
- Style: cozy pastel 3D-render look, Gooby mid-action, soft rim light, cream
  `#FFF6EC` vignette corners, NO text in the image (names render as DOM).
- Covers are UI assets (CSS `background-image`), NOT keyed through
  `src/core/assets.js`. A missing/unloadable cover falls back to the tinted
  icon-tile look (`onerror` swap — §G7.1 fallback rule).

Dir created by V4/G50 so the arcade grid (G68) and cover integration (G83)
have a stable root before the art lands.
