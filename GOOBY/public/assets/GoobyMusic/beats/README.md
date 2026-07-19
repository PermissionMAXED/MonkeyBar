# public/assets/GoobyMusic/beats/ — beat manifests (PLAN4.md §B5.3)

`scripts/gen-beats.mjs` (owned by V4/G51; ffmpeg, build-agent time, NOT CI)
writes `<basename>.beats.json` per `Recap - *` track here:
`{ "bpm": <float 1dp>, "offsetSec": <float 2dp>, "beatsPerBar": 4 }`.
A sibling `<basename>.beats.override.json` (hand-tuned) wins verbatim.
Builtin-track grids live in `public/assets/music/beats/`.

Dir created by V4/G50 so owner uploads and the G51 toolchain have a stable
root. Do not hand-edit generated files; use overrides.
